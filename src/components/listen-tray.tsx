"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type AnimationPlaybackControls, type MotionStyle, type MotionValue } from "motion/react";
import { ChevronDown, ChevronUp, Disc3, MicOff, Moon, Music, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FinderTune } from "@/lib/library";
import { useTuneListener, type Heard } from "@/lib/finder/use-listener";
import { useSessionRecorder } from "@/lib/finder/use-recorder";
import { clock, FinderAlternatives, FinderAnswer, FinderHeard, FinderScore, FinderSearch, meta, standing, time, type FinderContext } from "@/components/finder-parts";
import { OpeningPhrase } from "@/components/opening-phrase";
import { displayTitle } from "@/lib/titles";

const DRAG_START = 8, DRAG_DONE = 44;
// A flick counts as much as a long drag: px per ms.
const FLICK = 0.3;
// The fastest a flick is taken to be (px per ms), and the shortest stretch of movement it is measured over. A release a
// moment after one last move otherwise reads as a huge speed, and the sheet overshoots and snaps back.
const MAX_FLICK = 3, FLICK_WINDOW = 32;
// The most speed the sheet's spring starts with, in sheet heights per second: about what it can absorb without overshooting.
const MAX_SLIDE = 14;
// Critically damped, as iOS sheets are: quick, and it comes to rest without bouncing.
const SPRING = { type: "spring", stiffness: 300, damping: 35 } as const;
// The microphone follows the sheet on a spring of its own, so it trails the finger a touch and settles with the faintest give.
const MIC_SPRING = { stiffness: 300, damping: 30, mass: 0.9 };
// The icon's change of shape (microphone, dot, square) can afford a little more play.
const SHAPE_SPRING = { stiffness: 280, damping: 24 };
// The microphone in the deck's head (smaller in the desktop dock), and the record button it grows into.
const MINI = 50, DOCK_MINI = 40, BIG = 88, DOCK_BIG = 68;
// How long the deck opens for when a live session names a new tune, before it folds back down.
const PEEK_MS = 5000;
// How far, or how fast, a tune in the live setlist must be swiped to go.
const SWIPE = 110, SWIPE_SPEED = 600;
const TABS = [
  { href: "/", label: "Tunes", icon: Music, active: (path: string) => path === "/" || path.startsWith("/books") || path.startsWith("/tunes/") },
  { href: "/recordings", label: "Recordings", icon: Disc3, active: (path: string) => path.startsWith("/recordings") },
];
/** Past where the deck can go, the finger pulls against more and more resistance. */
const rubber = (distance: number, limit: number) => (distance * limit) / (limit + Math.abs(distance));
const unit = (value: number) => Math.min(1, Math.max(0, value));
const noop = () => () => undefined;
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
type Spot = { x: number; y: number };

/**
 * Session mode's bottom deck (or, in practice mode, `dock`: the same deck as a small panel in the bottom right corner of a
 * desktop, with no tabs and no scrim, so the page behind stays in use while it listens or records): one sheet across the foot of every screen, holding the microphone and its status above the tabs.
 * The whole sheet is always there; at rest only its head shows (and a tune the moment it is named). Dragged up, it follows the
 * finger, and the microphone rises with it, growing into the record button: docked it names one tune, opened it records the
 * session. Recording, the button becomes Stop. It lives in the root layout, so listening and recording carry on across pages.
 */
export function ListenTray({ signedIn, dock = false }: { signedIn: boolean; dock?: boolean }) {
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
  // While a newly named tune is shown for a moment in a live session; any touch on the deck keeps it open.
  const [peeking, setPeeking] = useState(false);
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
  const small = dock ? DOCK_MINI : MINI, large = dock ? DOCK_BIG : BIG;
  // The dock floats above the window's edge, so the part of it slid down out of sight is clipped away instead of off screen.
  const clip = useTransform(() => `inset(0px 0px ${Math.max(0, y.get())}px 0px round 16px)`);
  // Where the microphone sits in the head, and where the record button sits in the open sheet (none if it cannot record).
  const mini = useMotionValue<Spot>({ x: 0, y: 0 });
  const big = useMotionValue<Spot | null>(null);
  const grow = useSpring(useTransform(() => (big.get() ? unit(open.get()) : 0)), MIC_SPRING);
  // It swings up in a curve rather than a straight line: rising first, then drifting to the middle.
  const dialX = useTransform(() => { const a = mini.get(), b = big.get() ?? a, p = grow.get(); return a.x + (b.x - a.x) * p * Math.abs(p) - small / 2; });
  const dialY = useTransform(() => { const a = mini.get(), b = big.get() ?? a, p = grow.get(); return a.y + (b.y - a.y) * (1 - (1 - p) * Math.abs(1 - p)) - small / 2; });
  const dialScale = useTransform(() => 1 + (large / small - 1) * grow.get());
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
  const pointer = useRef<{ y: number; last: number; from: number; dragging: boolean; samples: { t: number; y: number }[] } | null>(null);
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
  // A live session keeps the deck folded: the tune playing now shows in its head instead, and its music in the open sheet.
  const shown = answer && !recording && answer.tuneId !== dismissed && (status === "match" || !listening) ? answer : null;

  const canRecord = signedIn && recorder.supported;

  // In a live session: the tune playing now (the last one named), and the ones before it since the recording began.
  const startedAt = recording ? Date.parse(recording.recordedAt) : 0;
  const tonight = recording ? listener.heard.filter((h) => h.at >= startedAt) : [];
  const now = tonight[0]?.tune ?? null;
  // A newly named tune opens the folded deck for a moment, then it folds itself away again.
  const newestKey = tonight[0] ? `${tonight[0].tune.tuneId}-${tonight[0].at}` : null;
  const [seenKey, setSeenKey] = useState(newestKey);
  if (newestKey !== seenKey) {
    setSeenKey(newestKey);
    if (newestKey && recording && !full && !dimmed) { setFull(true); setPeeking(true); }
  }
  const { reject } = recorder, { forgetHeard } = listener;
  /** A tune swiped away was named wrongly: it leaves the list, and the recording keeps it, marked, for training the finder. */
  const refuse = useCallback((heard: Heard) => { reject(heard.tune.tuneId); forgetHeard(heard); }, [reject, forgetHeard]);

  /** Opens or closes the sheet, springing from wherever it is with the finger's speed (px per second, down positive). */
  const slide = useCallback((target: boolean, speed = 0) => {
    if (!target && scroller.current) scroller.current.scrollTop = 0;
    springs.current.forEach((s) => s.stop());
    if (reduced) { open.set(target ? 1 : 0); shift.set(0); springs.current = []; return; }
    springs.current = [
      animate(open, target ? 1 : 0, { ...SPRING, velocity: Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, -speed / Math.max(range.get(), 1))) }),
      animate(shift, 0, SPRING),
    ];
  }, [reduced, open, shift, range]);
  const go = useCallback((target: boolean, speed = 0) => { setFull(target); setPeeking(false); slide(target, speed); }, [slide]);
  // Peeking, the deck rises, and the ring on its fold button runs down to when it folds again.
  useEffect(() => {
    if (!peeking) return;
    slide(true);
    const timer = window.setTimeout(() => go(false), PEEK_MS);
    return () => window.clearTimeout(timer);
  }, [peeking, slide, go]);
  // On a desktop, Escape folds the open dock away.
  useEffect(() => {
    if (!dock || !full) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("[role=dialog]")) go(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dock, full, go]);
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

  // The gesture is followed on the window, not the head: a fast flick (and any mouse) leaves the head before its first move
  // is seen, and a release elsewhere would otherwise leave the sheet stuck partway.
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const head = event.currentTarget as HTMLElement, id = event.pointerId;
    pointer.current = { y: event.clientY, last: event.clientY, from: open.get(), dragging: false, samples: [] }; dragged.current = false;
    const move = (e: PointerEvent) => { if (e.pointerId === id) onPointerMove(e, head); };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
      onPointerEnd(e);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };
  const onPointerMove = (event: PointerEvent, head: HTMLElement) => {
    const p = pointer.current;
    if (!p) return;
    p.last = event.clientY;
    const dy = event.clientY - p.y;
    // Claim the pointer only once it is a drag, so taps still reach the buttons but the release of a drag that left the deck comes back here.
    if (!p.dragging && Math.abs(dy) > DRAG_START) {
      p.dragging = true; if (head.isConnected) head.setPointerCapture(event.pointerId);
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
  const onPointerEnd = (event: PointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p?.dragging) return;
    dragged.current = true;
    // A cancelled gesture (the browser took the touch over) may report no position at all: it ends where the finger last was.
    const cancelled = event.type === "pointercancel", at = cancelled ? p.last : event.clientY;
    const dy = at - p.y;
    const first = p.samples[0];
    const raw = first && !cancelled ? (at - first.y) / Math.max(event.timeStamp - first.t, FLICK_WINDOW) : 0;
    const speed = Math.max(-MAX_FLICK, Math.min(MAX_FLICK, raw));
    if (!full && shown && (dy > DRAG_DONE || (speed > FLICK && dy > DRAG_START))) { setDismissed(shown.tuneId); go(false, speed * 1000); return; }
    // Where a flick would carry the sheet decides whether it opens.
    const landing = open.get() - (speed * 160) / Math.max(range.get(), 1);
    go(Math.abs(speed) > FLICK ? speed < 0 : landing > 0.5, speed * 1000);
  };

  const loaded = progress?.total ? progress.loaded / progress.total : 0;
  const arc = answer ? (status === "match" ? 1 : certainty) : listening ? certainty : 0;
  const count = recording ? recording.tunes.filter((t) => !t.rejected).length : listener.heard.length;
  const live = `Live ${clock(recorder.elapsed)}, ${count} ${count === 1 ? "tune" : "tunes"}`;
  const statusText = recording ? (now ? displayTitle(now.title) : "Listening for a tune")
    : phase === "loading" ? `Loading the tune model${progress?.total ? `, ${Math.round(100 * loaded)}%` : ""}`
    : phase === "starting" ? "Asking for the microphone"
    : phase === "denied" ? "Allow the microphone to listen"
    : phase === "error" ? "The tune finder stopped"
    : listening ? (status === "quiet" ? "Too quiet, move closer" : "Listening")
    : answer ? "Tap to name another tune" : "What's playing?";
  const hint = recording ? (listener.awake || dock ? live : `${live}. Keep the screen on.`)
    : canRecord ? "Expand to record a full session"
    : count > 0 ? `${count} heard tonight` : null;
  const label = full && canRecord ? (recording ? "Stop recording" : "Start recording the session") : recording ? "Live session: open it" : listening ? "Stop listening" : "Name the tune that's playing";
  const grab = { onPointerDown,
    onClickCapture: (event: React.MouseEvent) => { if (dragged.current) { dragged.current = false; event.stopPropagation(); event.preventDefault(); } } };
  const dialStyle = { x: dialX, y: dialY, scale: dialScale, opacity: dialFade, "--level": listener.level, "--loaded": loaded, "--record": recordTint } as unknown as MotionStyle;

  return <>
    {!dock && <motion.div className="deck-scrim" data-open={full ? "" : undefined} style={{ opacity: scrim }} onClick={() => go(false)} aria-hidden="true" />}
    {/* The dock's frame casts its shadow around whatever part of the clipped dock shows. */}
    <Frame dock={dock}><motion.section ref={deck} className={`deck ${recording ? "is-recording" : ""} ${dock ? "is-dock" : ""}`} data-open={full ? "" : undefined} aria-label={recording ? "Live session" : dock ? "Tune finder" : "Listening and navigation"} style={dock ? { y, clipPath: clip } : { y }} onPointerDownCapture={() => setPeeking(false)}>
      <div className="deck-head" {...grab}>
        <span className="deck-grip" aria-hidden="true" />
        <div className="deck-head-layers">
          <motion.div className="deck-listen" style={{ opacity: headRow }} inert={full}>
            <span ref={miniSlot} className="deck-mic-slot" aria-hidden="true" />
            <button type="button" className="deck-status" onClick={() => go(true)} aria-label={`${statusText}. ${recording ? "Open the live session" : "Open the session recorder"}`}>
              <span className={`deck-status-text ${now ? "is-tune" : ""}`}>{recording && <span className="finder-rec-dot" aria-hidden="true" />}<span className="deck-status-label">{statusText}</span>{listening && !now && status !== "quiet" && <span className="finder-dots" aria-hidden="true"><i /><i /></span>}</span>
              {hint && <span className="deck-hint">{hint}</span>}
            </button>
            {shown && !full ? <button type="button" className="icon-button deck-close" aria-label="Close this tune" onClick={() => setDismissed(shown.tuneId)}><X size={18} /></button>
              : <button type="button" className="icon-button deck-open" aria-label={recording ? "Open the live session" : "Open the session recorder"} tabIndex={-1} onClick={() => go(true)}><ChevronUp size={18} /></button>}
          </motion.div>
          <motion.div className="deck-full-head" style={{ opacity: headTitle }} inert={!full}>
            <h2 className="deck-title">{recording ? "Live session" : "Record a session"}</h2>
            <button type="button" className="icon-button deck-close" aria-label={peeking ? "Fold the deck down now (it folds by itself in a moment)" : "Fold the deck down"} onClick={() => go(false)}>
              {/* Opened by a new tune, the ring runs down to when it folds by itself. */}
              {peeking && <svg className="deck-countdown" viewBox="0 0 40 40" aria-hidden="true" style={{ animationDuration: `${PEEK_MS}ms` }}><circle cx="20" cy="20" r="18.5" pathLength={100} /></svg>}
              <ChevronDown size={18} />
            </button>
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
          <div className={`deck-record-start ${recording ? "is-live" : ""}`}>
            {canRecord ? <span ref={bigSlot} className="deck-record-slot" aria-hidden="true" /> : null}
            {/* Live, the Stop button sits beside the clock, so the tune playing now is the first thing below it. */}
            {recording ? <div className="deck-live-info">
              <p className="deck-live-clock">{clock(recorder.elapsed)}</p>
              <p className="deck-copy">{dock ? "Click Stop to finish and upload." : `${!listener.awake ? "Keep the screen on. " : ""}Tap Stop to finish and upload.`}</p>
              {!dock && <Button size="sm" variant="ghost" onClick={() => { go(false); setDimmed(true); }}><Moon size={14} /> Dim the screen</Button>}
            </div> : <p className="deck-copy">{canRecord ? `Records the whole session and names each tune as it goes. ${dock ? "Click" : "Tap"} any tune for its music.` : "This browser can't record. You can still name tunes one at a time from the microphone."}</p>}
          </div>

          {recording ? <>
            {tonight.length ? <LiveSetlist tonight={tonight} pointer={dock} onScore={setScore} onReject={refuse} />
              : <p className="deck-waiting">Listening for the first tune<span className="finder-dots" aria-hidden="true"><i /><i /></span></p>}
          </> : <>
            <FinderSearch context={context} />
            <FinderHeard context={context} />
          </>}
        </div>}
      </div>
    </motion.section></Frame>

    {/* The tabs stay put beneath the deck while it moves. A live session hides them: nothing else matters in the room. */}
    {!recording && !dock && <nav className="deck-tabs" aria-label="Session">{TABS.map(({ href, label, icon: Icon, active }) => {
      const current = active(path);
      return <Link key={href} href={href} className="deck-tab" aria-current={current ? "page" : undefined} onClick={() => go(false)}><Icon size={22} strokeWidth={current ? 2.25 : 1.75} /><span>{label}</span></Link>;
    })}</nav>}

    {dimmed && <button type="button" className="finder-pocket" onClick={() => setDimmed(false)} aria-label="Wake the screen"><span>Recording {clock(recorder.elapsed)}</span></button>}
    {score && <FinderScore tune={listener.tunes[score.tuneId] ?? score} context={context} onClose={() => setScore(null)} />}
  </>;
}

function Frame({ dock, children }: { dock: boolean; children: React.ReactNode }) {
  return dock ? <div className="deck-frame">{children}</div> : children;
}

/**
 * A live session's tunes, newest first. One is open, with its opening bars: the tune playing now, until another is tapped
 * (a new tune takes it back). Tapping the open one shows its full score. A tune swiped sideways goes, as named wrongly.
 */
function LiveSetlist({ tonight, pointer, onScore, onReject }: { tonight: Heard[]; pointer: boolean; onScore: (tune: FinderTune) => void; onReject: (heard: Heard) => void }) {
  const key = (heard: Heard) => `${heard.tune.tuneId}-${heard.at}`;
  const newest = key(tonight[0]);
  const [chosen, setChosen] = useState<{ key: string; newest: string } | null>(null);
  const openKey = chosen && chosen.newest === newest && tonight.some((h) => key(h) === chosen.key) ? chosen.key : newest;
  return <ul className="deck-setlist">
    <AnimatePresence initial={false}>
      {tonight.flatMap((heard, index) => {
        const item = <SetlistItem key={key(heard)} heard={heard} pointer={pointer} now={index === 0} open={key(heard) === openKey}
          onOpen={() => setChosen({ key: key(heard), newest })} onScore={() => onScore(heard.tune)} onReject={() => onReject(heard)} />;
        return index === 1 ? [<motion.li layout="position" key="played" className="deck-section" exit={{ opacity: 0 }}>Played tonight</motion.li>, item] : [item];
      })}
    </AnimatePresence>
  </ul>;
}

function SetlistItem({ heard, pointer, now, open, onOpen, onScore, onReject }: { heard: Heard; pointer: boolean; now: boolean; open: boolean; onOpen: () => void; onScore: () => void; onReject: () => void }) {
  const { tune, at } = heard;
  const x = useMotionValue(0);
  const fade = useTransform(() => 1 - unit(Math.abs(x.get()) / 240));
  // A swipe that ends over the tune is not also a tap.
  const swiped = useRef(false);
  const title = displayTitle(tune.title);
  return <motion.li layout="position" className="deck-setlist-item" data-open={open ? "" : undefined} style={{ x, opacity: fade }}
    drag="x" dragDirectionLock dragSnapToOrigin dragElastic={0.9} onDragStart={() => { swiped.current = true; }}
    onDragEnd={(_, info) => {
      if (Math.abs(info.offset.x) < SWIPE && Math.abs(info.velocity.x) < SWIPE_SPEED) return;
      const away = Math.sign(info.offset.x || info.velocity.x) * window.innerWidth;
      void animate(x, away, { duration: 0.2, ease: "easeOut" }).then(onReject);
    }}
    exit={{ height: 0, opacity: 0, transition: { duration: 0.22 } }}
    onClickCapture={(event) => { if (swiped.current) { swiped.current = false; event.stopPropagation(); } }}>
    <button type="button" onClick={open ? onScore : onOpen} aria-label={open ? `${title}: open the full score` : `${title}: show its opening bars`}>
      {(open || now) && <span className="deck-now-label">{now ? "Now playing" : `Played at ${time(at)}`}</span>}
      <span className="deck-tune-title">{title}</span>
      <span className="deck-tune-meta">{[meta(tune), standing(tune), open || now ? null : time(at)].filter(Boolean).join(", ")}</span>
      <AnimatePresence initial={false}>
        {open && <motion.span className="deck-setlist-music" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 35 }}>
          <OpeningPhrase tune={tune} />
          <span className="deck-now-more">{pointer ? "Click for the full score. Drag it aside if it is wrong." : "Tap for the full score. Swipe it away if it is wrong."}</span>
        </motion.span>}
      </AnimatePresence>
    </button>
  </motion.li>;
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
