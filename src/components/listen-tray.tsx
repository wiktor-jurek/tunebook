"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Disc3, Mic, MicOff, Moon, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { FinderTune } from "@/lib/library";
import { useTuneListener } from "@/lib/finder/use-listener";
import { useSessionRecorder, type LocalRecording } from "@/lib/finder/use-recorder";
import { clock, FinderAlternatives, FinderAnswer, FinderHeard, FinderScore, FinderSearch, meta, standing, time, type FinderContext } from "@/components/finder-parts";
import { OpeningPhrase } from "@/components/opening-phrase";
import { displayTitle } from "@/lib/titles";

const DRAG_START = 8, DRAG_DONE = 44;
// How long a newly named tune stays open while recording before the deck folds back down.
const RESULT_MS = 8000;
const TABS = [
  { href: "/", label: "Tunebooks", icon: BookOpen, active: (path: string) => path === "/" || path.startsWith("/books") || path.startsWith("/tunes/") },
  { href: "/recordings", label: "Recordings", icon: Disc3, active: (path: string) => path.startsWith("/recordings") },
];

/**
 * Session mode's bottom deck: one sheet across the foot of every screen, holding the microphone, its status and the tabs.
 * It rests at a peek; it grows to show a tune the moment it is named; dragged up it opens Tonight (search, the recording,
 * every tune heard). Dragging a named tune back down keeps listening as a session recording. It lives in the root layout,
 * so listening and recording carry on across pages.
 */
export function ListenTray({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const listener = useTuneListener();
  const recorder = useSessionRecorder(signedIn);
  const { phase, status, certainty, leader, level, progress, stop, start } = listener;
  const recording = recorder.active;
  const listening = phase === "listening";
  const busy = phase === "starting" || phase === "loading";
  const answer = leader && (status === "match" || status === "unsure") && (listening || phase === "idle") ? leader : null;
  const [full, setFull] = useState(false);
  const [score, setScore] = useState<FinderTune | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [dimmed, setDimmed] = useState(false);
  const [discarding, setDiscarding] = useState<LocalRecording | null>(null);
  const [drag, setDrag] = useState(0);
  const pointer = useRef<{ y: number; dragging: boolean } | null>(null);
  // A drag ends with the finger lifting over a button; that release must not also count as a tap.
  const dragged = useRef(false);
  const context: FinderContext = { listener, signedIn, next: "/", onScore: setScore };

  // Each newly named tune joins the recording's setlist.
  const newest = listener.heard[0]?.tune;
  const { mark } = recorder;
  useEffect(() => { if (newest) mark(newest); }, [newest, mark]);
  // Naming one tune stops at the first confident answer; a session recording keeps going.
  useEffect(() => { if (!recording && listening && status === "match" && leader) stop(); }, [recording, listening, status, leader, stop]);

  const result = answer && answer.tuneId !== dismissed ? answer : null;
  const detent = full ? "full" : result ? "result" : "peek";
  // While recording, a named tune is a passing notice: the deck folds back down after a few seconds.
  useEffect(() => {
    if (!recording || !result || full) return;
    const timer = window.setTimeout(() => setDismissed(result.tuneId), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [recording, result, full]);

  function listen() { setDismissed(null); void start(); }
  async function continueRecording() {
    if (!signedIn || !recorder.supported || recording) return;
    if (!listening) await start();
    const stream = listener.stream();
    if (!stream) return;
    await recorder.start(stream, `Session, ${new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`);
    // The tune that started it all opens the setlist.
    if (answer) mark(answer);
  }
  async function stopRecording() { await recorder.stop(); stop(); setDimmed(false); }
  function press() {
    if (recording) { setFull(true); return; }
    if (listening) stop(); else listen();
  }
  // Docked, the deck names one tune; dragged up, it becomes the session recorder. Down only ever folds it away.
  function foldDown() {
    if (full) { setFull(false); if (result) setDismissed(result.tuneId); return; }
    if (result) setDismissed(result.tuneId);
  }

  const onPointerDown = (event: React.PointerEvent) => { pointer.current = { y: event.clientY, dragging: false }; dragged.current = false; };
  const onPointerMove = (event: React.PointerEvent) => {
    const p = pointer.current;
    if (!p) return;
    const dy = event.clientY - p.y;
    // Claim the pointer only once it is a drag, so taps still reach the buttons but the release of a drag that left the deck comes back here.
    if (!p.dragging && Math.abs(dy) > DRAG_START) { p.dragging = true; event.currentTarget.setPointerCapture(event.pointerId); }
    if (p.dragging) setDrag(Math.max(-120, Math.min(160, dy)));
  };
  const onPointerEnd = () => {
    const p = pointer.current;
    pointer.current = null;
    if (!p?.dragging) return;
    dragged.current = true;
    const dy = drag;
    setDrag(0);
    if (dy > DRAG_DONE) foldDown(); else if (dy < -DRAG_DONE) setFull(true);
  };

  const canRecord = signedIn && recorder.supported;
  const loaded = progress?.total ? progress.loaded / progress.total : 0;
  const arc = answer ? (status === "match" ? 1 : certainty) : listening ? certainty : 0;
  const count = recording ? recording.tunes.length : listener.heard.length;
  const statusText = recording ? `Live session ${clock(recorder.elapsed)}, ${count} ${count === 1 ? "tune" : "tunes"}`
    : phase === "loading" ? `Loading the tune model${progress?.total ? `, ${Math.round(100 * loaded)}%` : ""}`
    : phase === "starting" ? "Asking for the microphone"
    : phase === "denied" ? "Allow the microphone to listen"
    : phase === "error" ? "The tune finder stopped"
    : listening ? (status === "quiet" ? "Too quiet, move closer" : "Listening")
    : answer ? "Tap to name another tune" : "Name a tune";
  const hint = recording ? (listener.awake ? "Drag up for tonight's tunes" : "Keep the screen on while it records")
    : canRecord ? "Drag up to record the whole session"
    : count > 0 ? `${count} heard tonight` : null;
  // In a live session: the tune playing now, and the ones named since the recording began.
  const startedAt = recording ? Date.parse(recording.recordedAt) : 0;
  const tonight = recording ? listener.heard.filter((h) => h.at >= startedAt) : [];
  const now = recording ? (answer ?? null) : null;
  const earlier = tonight.filter((h) => h.tune.tuneId !== now?.tuneId);
  const iconKey = recording || listening ? "stop" : phase === "denied" ? "denied" : "mic";
  const icon = { stop: <Square size={16} fill="currentColor" />, denied: <MicOff size={20} />, mic: <Mic size={20} /> }[iconKey];
  const grab = { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onClickCapture: (event: React.MouseEvent) => { if (dragged.current) { dragged.current = false; event.stopPropagation(); event.preventDefault(); } } };

  return <>
    {full && <div className="deck-scrim" onClick={() => setFull(false)} aria-hidden="true" />}
    <section className={`deck ${recording ? "is-recording" : ""}`} data-detent={detent} aria-label={recording ? "Live session" : "Listening and navigation"}
      style={drag ? { transform: `translateY(${drag > 0 ? drag * 0.6 : drag * 0.25}px)` } : undefined}>
      <div className="deck-head" {...grab}>
        <span className="deck-grip" aria-hidden="true" />
        {detent === "full" ? <div className="deck-full-head">
          <h2 className="deck-title">{recording ? "Live session" : "Record a session"}</h2>
          <button type="button" className="icon-button deck-close" aria-label="Fold the deck down" onClick={() => setFull(false)}><ChevronDown size={18} /></button>
        </div> : <div className="deck-listen">
          <div className="finder-dial is-mini" data-phase={phase} data-matched={status === "match" && answer ? "" : undefined} style={{ "--level": level, "--loaded": loaded } as React.CSSProperties}>
            {listening && <span className="finder-ripple" aria-hidden="true" />}
            <svg className="finder-arc" viewBox="0 0 100 100" aria-hidden="true"><circle className="finder-arc-track" cx="50" cy="50" r="48" /><circle className="finder-arc-fill" data-empty={arc <= 0 ? "" : undefined} cx="50" cy="50" r="48" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - 100 * arc} /></svg>
            <button type="button" className="finder-button" data-phase={phase} disabled={busy} onClick={press} aria-label={recording ? "Live session: open it" : listening ? "Stop listening" : "Name the tune that's playing"}>
              <span className="finder-icon" key={iconKey}>{icon}</span>
            </button>
          </div>
          <button type="button" className="deck-status" onClick={() => setFull(true)} aria-label={`${statusText}. ${recording ? "Open the live session" : "Open the session recorder"}`}>
            <span className="deck-status-text">{recording && <span className="finder-rec-dot" aria-hidden="true" />}{statusText}{listening && !recording && status !== "quiet" && <span className="finder-dots" aria-hidden="true"><i /><i /></span>}</span>
            {hint && <span className="deck-hint">{hint}</span>}
          </button>
          {detent === "result" && <button type="button" className="icon-button deck-close" aria-label="Close this tune" onClick={() => setDismissed(result!.tuneId)}><X size={18} /></button>}
        </div>}
      </div>

      {detent === "result" && result && <div className="deck-body deck-result" aria-live="polite">
        <FinderAnswer tune={result} sure={status === "match"} context={context} />
        <FinderAlternatives key={result.tuneId} sure={status === "match"} context={context} />
      </div>}

      {/* Dragged up and not yet recording: the deck is the session recorder, one big button. */}
      {detent === "full" && !recording && <div className="deck-body deck-full">
        <div className="deck-record-start">
          {canRecord ? <>
            <div className="finder-dial is-record" data-phase={phase} style={{ "--level": level, "--loaded": loaded } as React.CSSProperties}>
              <button type="button" className="finder-button" disabled={busy} onClick={() => void continueRecording()} aria-label="Start recording the session"><span className="finder-icon"><span className="deck-rec-glyph" /></span></button>
            </div>
            <p className="deck-copy">Records the whole session and names each tune as it goes. Tap any tune for its music.</p>
          </> : <p className="deck-copy">This browser can&apos;t record. You can still name tunes one at a time from the microphone below.</p>}
        </div>
        {recorder.pending.map((r) => { const state = recorder.uploads[r.id]; return <div className="finder-upload" key={r.id} role="status">
          <span>{r.name}, {clock(r.durationMs)}</span>{state?.status === "uploading" ? <span>Uploading</span> : <><button type="button" className="finder-link" onClick={() => void recorder.retry(r)}>{state?.status === "failed" ? "Retry upload" : "Upload"}</button><button type="button" className="finder-link" onClick={() => setDiscarding(r)}>Discard</button></>}
          {state?.status === "failed" && <span className="form-error">{state.error}</span>}</div>; })}
        <FinderSearch context={context} />
        <FinderHeard context={context} />
      </div>}

      {/* Recording: only what matters in the room. The tune playing now with its first bars, then the rest of tonight. */}
      {detent === "full" && recording && <div className="deck-body deck-full deck-live">
        <div className="deck-live-bar">
          <span className="finder-rec-dot" aria-hidden="true" /><span className="deck-live-clock">{clock(recorder.elapsed)}</span><span className="deck-copy">{recording.tunes.length} {recording.tunes.length === 1 ? "tune" : "tunes"}</span>
          {!listener.awake && <span className="finder-warning">Keep the screen on</span>}
          <span className="deck-live-actions"><Button size="sm" variant="ghost" onClick={() => { setFull(false); setDimmed(true); }} aria-label="Dim the screen"><Moon size={14} /></Button><Button size="sm" variant="danger" onClick={() => void stopRecording()}><Square size={12} fill="currentColor" /> Stop</Button></span>
        </div>
        {now ? <button type="button" className="deck-now" onClick={() => setScore(now)} aria-label={`${displayTitle(now.title)}: open the full score`}>
          <span className="deck-now-label">{status === "match" ? "Now playing" : "Possibly"}</span>
          <span className="deck-now-title">{displayTitle(now.title)}</span>
          <span className="deck-now-meta">{[meta(now), standing(now)].filter(Boolean).join(", ")}</span>
          <OpeningPhrase tune={now} />
          <span className="deck-now-more">Tap for the full score</span>
        </button> : <p className="deck-waiting">Listening for the next tune<span className="finder-dots" aria-hidden="true"><i /><i /></span></p>}
        {earlier.length > 0 && <section><h3 className="deck-section">Earlier tonight</h3>
          <ul className="deck-tunes">{earlier.map((h) => <li key={`${h.tune.tuneId}-${h.at}`}><button type="button" onClick={() => setScore(h.tune)}>
            <span className="deck-tune-title">{displayTitle(h.tune.title)}</span><span className="deck-tune-meta">{[meta(h.tune), standing(h.tune), time(h.at)].filter(Boolean).join(", ")}</span>
          </button></li>)}</ul>
        </section>}
        {recorder.pending.map((r) => <p className="finder-upload" key={r.id} role="status">{r.name}, waiting to upload</p>)}
      </div>}

      {!recording && <nav className="deck-tabs" aria-label="Session">{TABS.map(({ href, label, icon: Icon, active }) => {
        const current = active(path);
        return <Link key={href} href={href} className="deck-tab" aria-current={current ? "page" : undefined} onClick={() => setFull(false)}><Icon size={22} strokeWidth={current ? 2.25 : 1.75} /><span>{label}</span></Link>;
      })}</nav>}
    </section>

    <ConfirmDialog open={!!discarding} onOpenChange={(value) => { if (!value) setDiscarding(null); }} title={`Discard ${discarding?.name ?? "this recording"}?`} description="It has not been uploaded, so it will be gone for good." action="Discard" onConfirm={() => { if (discarding) void recorder.discard(discarding.id); setDiscarding(null); }} />
    {dimmed && <button type="button" className="finder-pocket" onClick={() => setDimmed(false)} aria-label="Wake the screen"><span>Recording {clock(recorder.elapsed)}</span></button>}
    {score && <FinderScore tune={listener.tunes[score.tuneId] ?? score} context={context} onClose={() => setScore(null)} />}
  </>;
}
