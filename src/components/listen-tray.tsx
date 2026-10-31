"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type AnimationPlaybackControls, type MotionStyle, type MotionValue } from "motion/react";
import { BookOpen, ChevronDown, Disc3, MicOff, Moon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { FinderTune } from "@/lib/library";
import { useTuneListener } from "@/lib/finder/use-listener";
import { useSessionRecorder, type LocalRecording } from "@/lib/finder/use-recorder";
import { clock, FinderAlternatives, FinderAnswer, FinderHeard, FinderScore, FinderSearch, meta, standing, time, type FinderContext } from "@/components/finder-parts";
import { OpeningPhrase } from "@/components/opening-phrase";
import { displayTitle } from "@/lib/titles";

const DRAG_START = 8, DRAG_DONE = 44;
// A flick counts as much as a long drag: px per ms.
const FLICK = 0.3;
// Critically damped, as iOS sheets are: quick, and it comes to rest without bouncing.
const SPRING = { type: "spring", stiffness: 300, damping: 35 } as const;
// The microphone follows the sheet on a spring of its own, so it trails the finger a touch and settles with the faintest give.
const MIC_SPRING = { stiffness: 300, damping: 30, mass: 0.9 };
// The icon's change of shape (microphone, dot, square) can afford a little more play.
const SHAPE_SPRING = { stiffness: 280, damping: 24 };
// The microphone in the deck's head, and the record button it grows into.
const MINI = 50, BIG = 104;
// How long a newly named tune stays open while recording before the deck folds back down.
const RESULT_MS = 8000;
const TABS = [
  { href: "/", label: "Tunebooks", icon: BookOpen, active: (path: string) => path === "/" || path.startsWith("/books") || path.startsWith("/tunes/") },
  { href: "/recordings", label: "Recordings", icon: Disc3, active: (path: string) => path.startsWith("/recordings") },
];
/** Past where the deck can go, the finger pulls against more and more resistance. */
const rubber = (distance: number, limit: number) => (distance * limit) / (limit + Math.abs(distance));
const unit = (value: number) => Math.min(1, Math.max(0, value));
const noop = () => () => undefined;
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
type Spot = { x: number; y: number };

/**
 * Session mode's bottom deck: one sheet across the foot of every screen, holding the microphone and its status above the tabs.
 * The whole sheet is always there; at rest only its head shows (and a tune the moment it is named). Dragged up, it follows the
 * finger, and the microphone rises with it, growing into the record button: docked it names one tune, opened it records the
 * session. Recording, the button becomes Stop. It lives in the root layout, so listening and recording carry on across pages.
 */
export function ListenTray({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const listener = useTuneListener();
  const recorder = useSessionRecorder(signedIn);
  const { phase, status, certainty, leader, progress, stop, start } = listener;
  const recording = recorder.active;
  const listening = phase === "listening";
  const busy = phase === "starting" || phase === "loading";
  const answer = leader && (status === "match" || status === "unsure") && (listening || phase === "idle") ? leader : null;
  const [full, setFull] = useState(false);
  const [score, setScore] = useState<FinderTune | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [dimmed, setDimmed] = useState(false);
  const [discarding, setDiscarding] = useState<LocalRecording | null>(null);
  // The hidden part of the sheet renders only once the deck can measure and tuck it away, so a page never loads with it open.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const context: FinderContext = { listener, signedIn, next: "/", onScore: setScore };

  // How open the sheet is, from 0 (only the head shows) to 1 (all of it). Dragging moves it directly and springs settle it,
  // so the sheet, the scrim and the microphone all move together on the compositor, never through React state.
  const open = useMotionValue(0);
  // How far the sheet travels between closed and open, and a correction that keeps it in place when its height changes.
  const range = useMotionValue(0);
  const shift = useMotionValue(0);
  const y = useTransform(() => (1 - open.get()) * range.get() + shift.get());
  const scrim = useTransform(() => unit(open.get()));
  // Where the microphone sits in the head, and where the record button sits in the open sheet (none if it cannot record).
  const mini = useMotionValue<Spot>({ x: 0, y: 0 });
  const big = useMotionValue<Spot | null>(null);
  const grow = useSpring(useTransform(() => (big.get() ? unit(open.get()) : 0)), MIC_SPRING);
  // It swings up in a curve rather than a straight line: rising first, then drifting to the middle.
  const dialX = useTransform(() => { const a = mini.get(), b = big.get() ?? a, p = grow.get(); return a.x + (b.x - a.x) * p * Math.abs(p) - MINI / 2; });
  const dialY = useTransform(() => { const a = mini.get(), b = big.get() ?? a, p = grow.get(); return a.y + (b.y - a.y) * (1 - (1 - p) * Math.abs(1 - p)) - MINI / 2; });
  const dialScale = useTransform(() => 1 + (BIG / MINI - 1) * grow.get());
  const dialFade = useTransform(() => (big.get() ? 1 : unit(1 - open.get() * 1.8)));
  const headRow = useTransform(() => unit(1 - open.get() * 1.8));
  const headTitle = useTransform(() => unit((open.get() - 0.45) / 0.55));
  const recordTint = useTransform(() => unit(grow.get()));
  // Stop shows as a square: always while recording, and while listening for one tune with the deck closed.
  const recordingNow = useMotionValue(0), listeningNow = useMotionValue(0);
  useEffect(() => { recordingNow.set(recording ? 1 : 0); listeningNow.set(listening ? 1 : 0); }, [recording, listening, recordingNow, listeningNow]);
  const recordingShape = useSpring(recordingNow, SHAPE_SPRING), listeningShape = useSpring(listeningNow, SHAPE_SPRING);
  const squareness = useTransform(() => unit(Math.max(recordingShape.get(), listeningShape.get() * (1 - unit(grow.get())))));

  const deck = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fold = useRef<HTMLDivElement>(null);
  const miniSlot = useRef<HTMLSpanElement>(null);
  const bigSlot = useRef<HTMLSpanElement>(null);
  const last = useRef<{ top: number; range: number } | null>(null);
  const springs = useRef<AnimationPlaybackControls[]>([]);
  const reduced = useReducedMotion();
  const pointer = useRef<{ y: number; from: number; dragging: boolean; samples: { t: number; y: number }[] } | null>(null);
  // A drag ends with the finger lifting over a button; that release must not also count as a tap.
  const dragged = useRef(false);

  // Each newly named tune joins the recording's setlist.
  const newest = listener.heard[0]?.tune;
  const { mark } = recorder;
  useEffect(() => { if (newest) mark(newest); }, [newest, mark]);
  // Naming one tune stops at the first confident answer; a session recording keeps going.
  useEffect(() => { if (!recording && listening && status === "match" && leader) stop(); }, [recording, listening, status, leader, stop]);

  // Guesses stay out of the docked sheet while it listens: they come and go, and a card that grows and shrinks with them
  // jumps about. It shows the tune once it is named, or the best guess once listening stops.
  const result = answer && answer.tuneId !== dismissed && (status === "match" || !listening) ? answer : null;
  // Open while recording, the tune playing now already leads the sheet; it is not shown twice.
  const shown = result && !(recording && full) ? result : null;
  // While recording, a named tune is a passing notice: it folds away after a few seconds.
  useEffect(() => {
    if (!recording || !result || full) return;
    const timer = window.setTimeout(() => setDismissed(result.tuneId), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [recording, result, full]);

  const canRecord = signedIn && recorder.supported;

  /** Opens or closes the sheet, springing from wherever it is with the finger's speed (px per second, down positive). */
  function go(target: boolean, speed = 0) {
    setFull(target);
    if (!target && scroller.current) scroller.current.scrollTop = 0;
    springs.current.forEach((s) => s.stop());
    if (reduced) { open.set(target ? 1 : 0); shift.set(0); springs.current = []; return; }
    springs.current = [
      animate(open, target ? 1 : 0, { ...SPRING, velocity: -speed / Math.max(range.get(), 1) }),
      animate(shift, 0, SPRING),
    ];
  }
  function listen() { setDismissed(null); void start(); }
  async function startRecording() {
    if (!canRecord || recording) return;
    if (!listening) await start();
    const stream = listener.stream();
    if (!stream) return;
    await recorder.start(stream, `Session, ${new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`);
    // The tune that started it all opens the setlist.
    if (answer) mark(answer);
  }
  async function stopRecording() { await recorder.stop(); stop(); setDimmed(false); }
  // One button, three jobs: docked it names a tune; opened it records the session; recording, it stops (or, docked, opens).
  function press() {
    if (full && canRecord) { if (recording) void stopRecording(); else void startRecording(); return; }
    if (recording) { go(true); return; }
    if (listening) stop(); else listen();
  }

  // Measures the sheet after every render and resize, before the browser paints. When its height changes (a tune named,
  // a list growing, a recording starting), it first keeps its top edge where it was, then springs to where it now rests.
  function follow() {
    const element = deck.current, marker = fold.current, list = scroller.current;
    if (!element || !marker || !list) return;
    const box = element.getBoundingClientRect();
    const top = box.top - y.get();
    const below = parseFloat(getComputedStyle(element).paddingBottom) || 0;
    const travel = Math.max(0, box.height - (marker.getBoundingClientRect().top - box.top + list.scrollTop) - below);
    const o = open.get();
    const before = last.current ? last.current.top + (1 - o) * last.current.range : null;
    last.current = { top, range: travel };
    range.set(travel);
    place();
    if (before === null) return;
    const moved = before - (top + (1 - o) * travel);
    if (Math.abs(moved) < 0.5) return;
    shift.set(shift.get() + moved);
    if (pointer.current?.dragging || reduced) { if (reduced) shift.set(0); return; }
    springs.current.push(animate(shift, 0, SPRING));
  }
  // Where the two microphone slots are, relative to the sheet (scrolling moves the open one).
  function place() {
    const element = deck.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const centre = (slot: HTMLElement) => { const r = slot.getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }; };
    if (miniSlot.current) mini.set(centre(miniSlot.current));
    big.set(bigSlot.current ? centre(bigSlot.current) : null);
  }
  useLayoutEffect(follow);
  useEffect(() => {
    const element = deck.current;
    if (!element) return;
    const observer = new ResizeObserver(() => follow());
    observer.observe(element);
    for (const child of Array.from(scroller.current?.children ?? [])) observer.observe(child);
    // A rotated phone moves the deck without animating it.
    const reset = () => { last.current = null; follow(); };
    window.addEventListener("resize", reset);
    return () => { observer.disconnect(); window.removeEventListener("resize", reset); };
  });

  const onPointerDown = (event: React.PointerEvent) => { pointer.current = { y: event.clientY, from: open.get(), dragging: false, samples: [] }; dragged.current = false; };
  const onPointerMove = (event: React.PointerEvent) => {
    const p = pointer.current;
    if (!p) return;
    const dy = event.clientY - p.y;
    // Claim the pointer only once it is a drag, so taps still reach the buttons but the release of a drag that left the deck comes back here.
    if (!p.dragging && Math.abs(dy) > DRAG_START) {
      p.dragging = true; event.currentTarget.setPointerCapture(event.pointerId);
      // Caught mid-spring, the sheet stays under the finger.
      springs.current.forEach((s) => s.stop()); p.from = open.get();
    }
    if (!p.dragging) return;
    p.samples = [...p.samples.filter((s) => event.timeStamp - s.t < 100), { t: event.timeStamp, y: event.clientY }];
    const travel = Math.max(range.get(), 1);
    const raw = p.from - dy / travel;
    // The sheet follows the finger between closed and open; beyond, it resists. A named tune can be pulled down and away.
    open.set(raw > 1 ? 1 + rubber((raw - 1) * travel, 60) / travel : raw < 0 && !shown ? rubber(raw * travel, 60) / travel : raw);
  };
  const onPointerEnd = (event: React.PointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p?.dragging) return;
    dragged.current = true;
    const dy = event.clientY - p.y;
    const first = p.samples[0];
    const speed = first && event.timeStamp > first.t ? (event.clientY - first.y) / (event.timeStamp - first.t) : 0;
    if (!full && shown && (dy > DRAG_DONE || (speed > FLICK && dy > DRAG_START))) { setDismissed(shown.tuneId); go(false, speed * 1000); return; }
    // Where a flick would carry the sheet decides whether it opens.
    const landing = open.get() - (speed * 160) / Math.max(range.get(), 1);
    go(Math.abs(speed) > FLICK ? speed < 0 : landing > 0.5, speed * 1000);
  };

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
  const label = full && canRecord ? (recording ? "Stop recording" : "Start recording the session") : recording ? "Live session: open it" : listening ? "Stop listening" : "Name the tune that's playing";
  const grab = { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onClickCapture: (event: React.MouseEvent) => { if (dragged.current) { dragged.current = false; event.stopPropagation(); event.preventDefault(); } } };
  const dialStyle = { x: dialX, y: dialY, scale: dialScale, opacity: dialFade, "--level": listener.level, "--loaded": loaded, "--record": recordTint } as unknown as MotionStyle;

  return <>
    <motion.div className="deck-scrim" data-open={full ? "" : undefined} style={{ opacity: scrim }} onClick={() => go(false)} aria-hidden="true" />
    <motion.section ref={deck} className={`deck ${recording ? "is-recording" : ""}`} data-open={full ? "" : undefined} aria-label={recording ? "Live session" : "Listening and navigation"} style={{ y }}>
      <div className="deck-head" {...grab}>
        <span className="deck-grip" aria-hidden="true" />
        <div className="deck-head-layers">
          <motion.div className="deck-listen" style={{ opacity: headRow }} inert={full}>
            <span ref={miniSlot} className="deck-mic-slot" aria-hidden="true" />
            <button type="button" className="deck-status" onClick={() => go(true)} aria-label={`${statusText}. ${recording ? "Open the live session" : "Open the session recorder"}`}>
              <span className="deck-status-text">{recording && <span className="finder-rec-dot" aria-hidden="true" />}{statusText}{listening && !recording && status !== "quiet" && <span className="finder-dots" aria-hidden="true"><i /><i /></span>}</span>
              {hint && <span className="deck-hint">{hint}</span>}
            </button>
            {shown && !full && <button type="button" className="icon-button deck-close" aria-label="Close this tune" onClick={() => setDismissed(shown.tuneId)}><X size={18} /></button>}
          </motion.div>
          <motion.div className="deck-full-head" style={{ opacity: headTitle }} inert={!full}>
            <h2 className="deck-title">{recording ? "Live session" : "Record a session"}</h2>
            <button type="button" className="icon-button deck-close" aria-label="Fold the deck down" onClick={() => go(false)}><ChevronDown size={18} /></button>
          </motion.div>
        </div>

        {/* One microphone, carried by the sheet: it rises and grows into the record button as the deck opens. */}
        <motion.div className="finder-dial is-mini is-deck" data-phase={phase} data-matched={status === "match" && answer ? "" : undefined} data-hidden={full && !canRecord ? "" : undefined} style={dialStyle}>
          {listening && <span className="finder-ripple" aria-hidden="true" />}
          <svg className="finder-arc" viewBox="0 0 100 100" aria-hidden="true"><circle className="finder-arc-track" cx="50" cy="50" r="48" /><circle className="finder-arc-fill" data-empty={arc <= 0 ? "" : undefined} cx="50" cy="50" r="48" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - 100 * arc} /></svg>
          <button type="button" className="finder-button" data-phase={phase} disabled={busy} onClick={press} aria-label={label}>
            <span className="deck-dial-record" aria-hidden="true" />
            <span className="finder-icon">{phase === "denied" ? <MicOff size={20} /> : <MicShape dot={recordTint} square={squareness} />}</span>
          </button>
        </motion.div>
      </div>

      <div ref={scroller} className="deck-scroll" onScroll={place}>
        {shown && <div className="deck-result" aria-live="polite">
          <FinderAnswer tune={shown} sure={status === "match"} context={context} />
          <FinderAlternatives key={shown.tuneId} sure={status === "match"} context={context} />
        </div>}
        <div ref={fold} aria-hidden="true" />

        {/* The rest of the sheet, below the fold: the recorder, or the live session. */}
        {hydrated && <div className="deck-more" inert={!full}>
          <div className="deck-record-start">
            {canRecord ? <span ref={bigSlot} className="deck-record-slot" aria-hidden="true" /> : null}
            {recording ? <>
              <p className="deck-live-clock">{clock(recorder.elapsed)}</p>
              <p className="deck-copy">{recording.tunes.length} {recording.tunes.length === 1 ? "tune" : "tunes"} so far. Tap to stop and upload.</p>
            </> : <p className="deck-copy">{canRecord ? "Records the whole session and names each tune as it goes. Tap any tune for its music." : "This browser can't record. You can still name tunes one at a time from the microphone."}</p>}
          </div>

          {recording ? <>
            <div className="deck-live-bar">
              {!listener.awake && <span className="finder-warning">Keep the screen on</span>}
              <Button size="sm" variant="ghost" onClick={() => { go(false); setDimmed(true); }}><Moon size={14} /> Dim the screen</Button>
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
          </> : <>
            {recorder.pending.map((r) => { const state = recorder.uploads[r.id]; return <div className="finder-upload" key={r.id} role="status">
              <span>{r.name}, {clock(r.durationMs)}</span>{state?.status === "uploading" ? <span>Uploading</span> : <><button type="button" className="finder-link" onClick={() => void recorder.retry(r)}>{state?.status === "failed" ? "Retry upload" : "Upload"}</button><button type="button" className="finder-link" onClick={() => setDiscarding(r)}>Discard</button></>}
              {state?.status === "failed" && <span className="form-error">{state.error}</span>}</div>; })}
            <FinderSearch context={context} />
            <FinderHeard context={context} />
          </>}
        </div>}
      </div>
    </motion.section>

    {/* The tabs stay put beneath the deck while it moves. A live session hides them: nothing else matters in the room. */}
    {!recording && <nav className="deck-tabs" aria-label="Session">{TABS.map(({ href, label, icon: Icon, active }) => {
      const current = active(path);
      return <Link key={href} href={href} className="deck-tab" aria-current={current ? "page" : undefined} onClick={() => go(false)}><Icon size={22} strokeWidth={current ? 2.25 : 1.75} /><span>{label}</span></Link>;
    })}</nav>}

    <ConfirmDialog open={!!discarding} onOpenChange={(value) => { if (!value) setDiscarding(null); }} title={`Discard ${discarding?.name ?? "this recording"}?`} description="It has not been uploaded, so it will be gone for good." action="Discard" onConfirm={() => { if (discarding) void recorder.discard(discarding.id); setDiscarding(null); }} />
    {dimmed && <button type="button" className="finder-pocket" onClick={() => setDimmed(false)} aria-label="Wake the screen"><span>Recording {clock(recorder.elapsed)}</span></button>}
    {score && <FinderScore tune={listener.tunes[score.tuneId] ?? score} context={context} onClose={() => setScore(null)} />}
  </>;
}

/**
 * The deck's microphone, drawn so it can change shape: as the deck opens its stand undraws and the capsule swells and fills
 * into the record dot (`dot`, 0 to 1); listening or recording, it squares off into Stop (`square`, 0 to 1).
 */
function MicShape({ dot, square }: { dot: MotionValue<number>; square: MotionValue<number> }) {
  // Lucide's microphone capsule, the record dot and the stop square, in its 24-unit box.
  const round = useTransform(() => unit(Math.max(dot.get(), square.get())));
  const between = (capsule: number, disc: number, box: number) => mix(mix(capsule, disc, round.get()), box, square.get());
  const width = useTransform(() => between(6, 16, 12)), height = useTransform(() => between(13, 16, 12)), corner = useTransform(() => between(3, 8, 2.5));
  const x = useTransform(() => 12 - width.get() / 2);
  const y = useTransform(() => between(2, 4, 6));
  const stand = useTransform(() => 1 - round.get());
  return <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <motion.rect width={width} height={height} rx={corner} fill="currentColor" fillOpacity={round} style={{ x, y }} />
    <motion.path d="M19 10v2a7 7 0 0 1-14 0v-2" style={{ pathLength: stand, opacity: stand }} />
    <motion.path d="M12 19v3" style={{ pathLength: stand, opacity: stand }} />
  </svg>;
}
