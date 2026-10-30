"use client";

import { useEffect, useState } from "react";
import { Check, Mic, MicOff, Square } from "lucide-react";
import type { FinderTune } from "@/lib/library";
import { useTuneListener } from "@/lib/finder/use-listener";
import { FinderAlternatives, FinderAnswer, FinderHeard, FinderScore, type FinderContext } from "@/components/finder-parts";

/** The listening prompt for any phase without an answer yet. */
export function finderPrompt(listener: FinderContext["listener"], idle: string) {
  const { phase, progress, status } = listener;
  return phase === "denied" ? "Allow the microphone for this site in your browser settings, then try again."
    : phase === "error" ? listener.error
    : phase === "loading" ? `Loading the tune model${progress?.total ? `, ${Math.round(progress.loaded / 1e6)} of ${Math.round(progress.total / 1e6)} MB` : ""}. Only the first time.`
    : phase === "starting" ? "Asking for the microphone"
    : phase === "listening" ? (status === "quiet" ? "Too quiet. Move closer to the music." : "Listening")
    : idle;
}

/**
 * One button that names the tune that's playing, for the desktop finder and the landing page (`hero`, without the
 * heard list). It stops at the first confident answer, like Shazam. On a phone in session mode the listen tray does this instead.
 */
export function TuneFinder({ signedIn, layout = "page" }: { signedIn: boolean; layout?: "page" | "hero" }) {
  const listener = useTuneListener();
  const { phase, status, certainty, leader, level, progress } = listener;
  const [sheet, setSheet] = useState<FinderTune | null>(null);
  const listening = phase === "listening";
  const busy = phase === "starting" || phase === "loading";
  // The answer stays on screen after listening stops, until the next listen starts.
  const answer = leader && (status === "match" || status === "unsure") && (listening || phase === "idle") ? leader : null;
  const loaded = progress?.total ? progress.loaded / progress.total : 0;
  const context: FinderContext = { listener, signedIn, next: "/tunes/finder", onScore: setSheet };

  const { stop } = listener;
  useEffect(() => { if (listening && status === "match" && leader) stop(); }, [listening, status, leader, stop]);

  const compact = !!answer && !listening;
  const iconKey = listening ? "stop" : phase === "denied" ? "denied" : "mic";
  const icon = { stop: <Square size={26} fill="currentColor" />, denied: <MicOff size={30} />, mic: <Mic size={30} /> }[iconKey];
  // The arc shows how sure the finder is: orange while it is still deciding (live), ink once it has matched (settled).
  const arc = answer ? (status === "match" ? 1 : certainty) : listening ? certainty : 0;
  const matched = status === "match" && answer ? answer.tuneId : null;

  // The answer and its controls form one column: below the button on a phone held upright, beside it on its side.
  return <div className={`tune-finder finder-${layout}`} data-mode="name" data-compact={compact ? "" : undefined}>
    <div className="finder-dial" data-phase={phase} data-matched={matched ? "" : undefined} style={{ "--level": level, "--loaded": loaded } as React.CSSProperties}>
      {listening && <><span className="finder-ripple" aria-hidden="true" /><span className="finder-ripple" aria-hidden="true" /></>}
      <svg className="finder-arc" viewBox="0 0 100 100" aria-hidden="true"><circle className="finder-arc-track" cx="50" cy="50" r="48" /><circle className="finder-arc-fill" data-empty={arc <= 0 ? "" : undefined} cx="50" cy="50" r="48" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - 100 * arc} /></svg>
      <button type="button" className="finder-button" data-phase={phase} disabled={busy} onClick={() => { if (listening) listener.stop(); else void listener.start(); }} aria-label={listening ? "Stop listening" : answer ? "Listen again" : "Name the tune that's playing"}>
        <span className="finder-icon" key={iconKey}>{icon}</span>
        {/* A confident answer ends like the mark does, in a tick; it plays once per tune named. */}
        {matched && <span className="finder-tick" key={`tick-${matched}`} aria-hidden="true"><Check size={34} strokeWidth={3} /></span>}
      </button>
    </div>
    {compact && <span className="finder-again" aria-hidden="true">Listen again</span>}
    <div className="finder-main">
      <div className="finder-stage" aria-live="polite">
        {answer ? <FinderAnswer tune={answer} sure={status === "match"} context={context} />
          : <p className="finder-prompt" role={phase === "error" ? "alert" : undefined}>{finderPrompt(listener, "Tap to name the tune that's playing. It listens on this device and uploads nothing.")}{listening && status !== "quiet" && <span className="finder-dots" aria-hidden="true"><i /><i /></span>}</p>}
      </div>
      {answer && <FinderAlternatives key={answer.tuneId} sure={status === "match"} context={context} />}
    </div>
    {layout !== "hero" && <FinderHeard context={context} />}
    {sheet && <FinderScore tune={listener.tunes[sheet.tuneId] ?? sheet} context={context} onClose={() => setSheet(null)} />}
  </div>;
}
