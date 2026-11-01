"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import abcjs from "abcjs";
import { Check, Link2, Pause, Play, RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AbilityMark } from "@/components/ability-mark";
import { RepeatMark } from "@/components/repeat-mark";
import { ABILITY_LEVELS, playAlongSentence, resolvePractice, type AbilityLevel } from "@/lib/ability";
import { keyName, openingPhrase } from "@/lib/notation";
import { DEFAULT_SOUND } from "@/lib/sounds";
import { scorePosition, TIMING_UNIT } from "@/lib/playalong-timing";
import type { PlayalongTiming } from "@/db/schema";

// The specimen night the landing page's three demos share: one set of three jigs, some chat, then a reel.
type Sample = { settingId: number; title: string; kind: string; meter: string; mode: string; abc: string; start: number; end: number; level: AbilityLevel };
const NIGHT: Sample[] = [
  { settingId: 55, title: "The Kesh", kind: "jig", meter: "6/8", mode: "Gmajor", start: 0, end: 190, level: "learned",
    abc: "|:G3 GAB|A3 ABd|edd gdd|edB dBA|G3 GAB|A3 ABd|edd gdB|AGF G2D:||:B3 dBd|ege dBG|B3 dBG|ABA AGA|B3 dBd|ege dBd|gfg aga|bgf g2d:|" },
  { settingId: 71, title: "Morrison's", kind: "jig", meter: "6/8", mode: "Edorian", start: 190, end: 370, level: "mastered",
    abc: "|:E3 BEB|EBE AFD|EDE B2c|dcB AFD|E3 BEB|EBE AFD|G3 FGA|dAG FED:||:Bee fee|aee fed|Bee fee|a2g fed|Bee fee|aee fed|gfe d2A|BAG FED:|" },
  { settingId: 108, title: "Out on the Ocean", kind: "jig", meter: "6/8", mode: "Gmajor", start: 370, end: 560, level: "unlearned",
    abc: "|:D2B BAG|BdB A2B|GED G2A|B2B AGE|D2B BAG|BdB A2B|GED G2A|BGF G3:||:efe edB|efe fdB|ded dBd|gfe dBA|G2A B2d|ege dBA|GED G2A|BGF G3:|" },
  { settingId: 1, title: "Cooley's", kind: "reel", meter: "4/4", mode: "Edorian", start: 620, end: 840, level: "learning",
    abc: "|:EBBA B2 EB|B2 AB dBAG|FDAD BDAD|FDAD dAFD|EBBA B2 EB|B2 AB defg|afec dBAF|DEFD E2 GF:||:eB B2 efge|eB B2 gedB|A2 FA DAFA|A2 FA defg|eB B2 eBgB|eB B2 defg|afec dBAF|DEFD E2 GF:|" },
];
const LENGTH = 840;
const meta = (tune: Sample) => `${tune.kind[0].toUpperCase()}${tune.kind.slice(1)}, ${keyName(tune.mode)}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pct = (s: number) => `${(100 * s) / LENGTH}%`;
const standing = (level: AbilityLevel) => (level === "learned" || level === "mastered" ? "join" : level === "learning" || level === "wanted" ? "learning" : "new");

/** How long the finder takes to name a tune in the demo, in the night's seconds. */
const NAMING = 28;
/** The demo plays the night at this many times real speed: 14 minutes in about nine seconds. */
const SPEED = 95;

/** A recording that plays itself out when it scrolls into view: the clock runs and each tune is heard, then named. */
export function RecordDemo() {
  const card = useRef<HTMLDivElement>(null);
  const seen = useInView(card, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const [t, setT] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (reduced) { const id = requestAnimationFrame(() => setT(LENGTH)); return () => cancelAnimationFrame(id); }
    let raf = 0, from = 0;
    const tick = (now: number) => {
      from ||= now;
      const next = Math.min(LENGTH, ((now - from) / 1000) * SPEED);
      setT(next);
      if (next < LENGTH) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, reduced, run]);

  const done = t >= LENGTH;
  const heard = NIGHT.filter((tune) => t >= tune.start);
  const playing = NIGHT.find((tune) => t >= tune.start && t < tune.end);
  return (
    <Card ref={card} className="lp-card lp-record" data-live={seen && !done ? "" : undefined}>
      <div className="lp-card-head">
        <span className="lp-live">
          {done ? <><Check size={14} /> Saved</> : <><span className="finder-rec-dot" aria-hidden="true" /> Recording</>}
        </span>
        <span className="lp-level" aria-hidden="true" data-on={playing && !done ? "" : undefined}><i /><i /><i /><i /><i /></span>
        <span className="lp-clock">{clock(t)}</span>
      </div>

      <div className="lp-track" aria-hidden="true">
        {heard.map((tune) => {
          const named = t >= tune.start + NAMING;
          return <span key={tune.title} className="lp-track-seg" data-named={named ? "" : undefined} style={{ left: pct(tune.start), width: pct(Math.min(t, tune.end) - tune.start) }} />;
        })}
        {!done && <span className="lp-track-head" style={{ left: pct(t) }} />}
      </div>

      <ol className="lp-night" aria-live="polite">
        <AnimatePresence initial={false}>
          {heard.map((tune, i) => {
            const named = t >= tune.start + NAMING;
            return (
              <motion.li key={`${run}-${tune.title}`} data-set={i < 3 ? "" : undefined}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
                <span className="lp-set">{i === 0 && <RepeatMark />}</span>
                <AnimatePresence mode="wait" initial={false}>
                  {named ? (
                    <motion.span key="named" className="lp-tune" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                      <strong>{tune.title}</strong><small>{meta(tune)}</small>
                    </motion.span>
                  ) : (
                    <motion.span key="listening" className="lp-tune is-listening" exit={{ opacity: 0, y: -4 }}>
                      <strong>Listening<span className="finder-dots" aria-hidden="true"><i /><i /></span></strong><small>&nbsp;</small>
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className="lp-at">{clock(tune.start)}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      <div className="lp-card-foot">
        <AnimatePresence>
          {done && !reduced && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button variant="ghost" size="sm" onClick={() => { setT(0); setRun((r) => r + 1); }}><RotateCcw size={13} /> Play it again</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

/** The night coloured by what you can play. Tapping a tune moves it up a step, and the night and the sentence follow. */
export function ProgressDemo() {
  const [levels, setLevels] = useState(() => NIGHT.map((tune) => tune.level));
  const playable = levels.filter((level) => standing(level) === "join").length;
  const step = (i: number) =>
    setLevels((prev) => prev.map((level, j) => (j === i ? ABILITY_LEVELS[(ABILITY_LEVELS.indexOf(level) + 1) % ABILITY_LEVELS.length] : level)));
  return (
    <Card className="lp-card">
      <div className="lp-track is-night" aria-hidden="true">
        {NIGHT.map((tune, i) => (
          <span key={tune.title} className="lp-track-seg" data-standing={standing(levels[i])} style={{ left: pct(tune.start), width: pct(tune.end - tune.start) }} />
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={playable} className="lp-sentence" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {playAlongSentence(playable, levels.length)}
        </motion.p>
      </AnimatePresence>
      <ul className="lp-progress">
        {NIGHT.map((tune, i) => (
          <li key={tune.title}>
            <button type="button" className="lp-progress-row" onClick={() => step(i)} aria-label={`${tune.title}: move its progress up a step`}>
              <span className="lp-tune"><strong>{tune.title}</strong><small>{meta(tune)}</small></span>
              <motion.span key={levels[i]} initial={{ scale: 0.85, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}>
                {levels[i] === "unlearned" ? <span className="chip">Learn it</span> : <AbilityMark practice={resolvePractice(null, levels[i])} label />}
              </motion.span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

let audio: AudioContext | null = null;

/** A play-along recording the landing page can tease: its lead instrument, link and timing against the score. */
export type DemoTrack = { label: string; url: string; timing: PlayalongTiming | null };
const BOOK = NIGHT.slice(0, 3);
const lead = (label: string) => label.split(/ with /i)[0];
/** The tunebook shows, and plays, this many bars of each tune. */
const BARS = 4;
/** The fade at the end of the bars, in milliseconds, so the recording doesn't cut off mid-note. */
const FADE = 250;

// The moment in a recording where the score starts: the first anchor at or past position 0, interpolated.
function scoreStart({ anchors }: PlayalongTiming) {
  const i = anchors.findIndex(([, position]) => position >= 0);
  if (i <= 0) return Math.max(0, anchors[0]?.[0] ?? 0);
  const [fromMs, from] = anchors[i - 1], [toMs, to] = anchors[i];
  return fromMs + (toMs - fromMs) * (0 - from) / (to - from);
}

/**
 * A tunebook: pick a tune from its set to see its opening bars, and play along with a real recording of it (fiddle,
 * flute or whistle with guitar), its notes lighting up as they're played. Without recordings, it plays the score itself.
 */
export function BookDemo({ tracks }: { tracks: Record<number, DemoTrack[]> }) {
  const [chosen, setChosen] = useState(0);
  const [instrument, setInstrument] = useState(0);
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const paper = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const player = useRef<{ el?: HTMLAudioElement; source?: AudioBufferSourceNode; timer?: abcjs.TimingCallbacks; raf?: number; visual?: abcjs.TuneObject; follow?: abcjs.NoteTimingEvent[]; token: number }>({ token: 0 });
  const options = tracks[BOOK[chosen].settingId] ?? [];
  const track = options[Math.min(instrument, options.length - 1)];
  const timed = (t?: DemoTrack): t is DemoTrack & { timing: PlayalongTiming } => !!t?.timing && t.timing.anchors.length > 1;

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  const light = useCallback((elements: Element[] = []) => {
    paper.current?.querySelectorAll(".is-sounding").forEach((el) => el.classList.remove("is-sounding"));
    elements.forEach((el) => el.classList.add("is-sounding"));
  }, []);
  const stop = useCallback(() => {
    const p = player.current;
    p.token++;
    p.el?.pause();
    try { p.source?.stop(); } catch {}
    p.timer?.stop();
    if (p.raf) cancelAnimationFrame(p.raf);
    p.el = p.source = p.timer = undefined;
    light();
    if (bar.current) bar.current.style.transform = "scaleX(0)";
    setPlaying(false);
    setLoading(false);
  }, [light]);

  useEffect(() => {
    if (!paper.current) return;
    const [visual] = abcjs.renderAbc(paper.current, openingPhrase(BOOK[chosen], BARS), { responsive: "resize", add_classes: true, staffwidth: 620, paddingtop: 0, paddingbottom: 0, paddingleft: 0, paddingright: 0 });
    player.current.visual = visual;
    player.current.follow = new abcjs.TimingCallbacks(visual, {}).noteTimings.filter((event) => event.type === "event");
    return () => stop();
  }, [chosen, stop]);

  // The recording, from the first note to the end of the bars shown, following them as the full score does.
  function playRecording(chosenTrack: DemoTrack & { timing: PlayalongTiming }, at?: number) {
    const p = player.current;
    const el = new Audio(chosenTrack.url);
    el.currentTime = (at ?? scoreStart(chosenTrack.timing)) / 1000;
    p.el = el;
    el.onended = () => { if (p.el === el) stop(); };
    const follow = () => {
      if (p.el !== el) return;
      const visual = p.visual, notes = p.follow ?? [];
      const position = scorePosition(chosenTrack.timing, el.currentTime * 1000);
      if (!visual || !notes.length) return stop();
      const perWhole = notes[0].millisecondsPerMeasure / visual.getBarLength();
      // The pickup, then the bars shown.
      const end = (visual.getPickupLength() + BARS * visual.getBarLength()) * perWhole;
      const ms = position === null ? null : position / TIMING_UNIT * perWhole;
      if (ms !== null && ms >= end) return stop();
      if (ms !== null) {
        el.volume = Math.max(0, Math.min(1, (end - ms) / FADE));
        if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0, ms / end)})`;
        let i = -1;
        while (i + 1 < notes.length && notes[i + 1].milliseconds <= ms) i++;
        light(i >= 0 ? (notes[i].elements?.flat() as Element[]) : []);
      }
      p.raf = requestAnimationFrame(follow);
    };
    el.onplaying = () => setLoading(false);
    void el.play().then(() => { p.raf = requestAnimationFrame(follow); }, () => { if (p.el === el) stop(); });
  }

  // Without a recording, the score itself through the synth.
  async function playScore() {
    const p = player.current, visual = p.visual;
    if (!visual || !abcjs.synth.supportsAudio()) return stop();
    const token = p.token;
    audio ??= new AudioContext();
    await audio.resume();
    const synth = new abcjs.synth.CreateSynth();
    await synth.init({ visualObj: visual, audioContext: audio, options: { program: DEFAULT_SOUND, soundFontUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/" } });
    await synth.prime();
    const buffer = synth.getAudioBuffer();
    if (!buffer || p.token !== token) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.onended = () => { if (p.source === source) stop(); };
    p.source = source;
    p.timer = new abcjs.TimingCallbacks(visual, { eventCallback: (event) => { light(event?.elements?.flat() as Element[] | undefined); return undefined; } });
    setLoading(false);
    source.start();
    p.timer.start();
  }

  function play() {
    if (playing) return stop();
    setPlaying(true);
    setLoading(true);
    if (timed(track)) playRecording(track);
    else void playScore();
  }

  // Switching instrument mid-tune carries on from the same moment in the other recording.
  function choose(i: number) {
    setInstrument(i);
    const p = player.current, next = options[i];
    if (!playing || !p.el || !timed(track) || !timed(next)) return;
    // The same point in the score, which sits at a different moment in the other recording.
    const position = scorePosition(track.timing, p.el.currentTime * 1000);
    const at = position === null ? undefined : next.timing.anchors.find(([, pos]) => pos >= position)?.[0];
    p.el.pause();
    p.el = undefined;
    playRecording(next, at);
  }

  return (
    <Card className="lp-card lp-book">
      <div className="lp-book-head">
        <span className="lp-book-icon" aria-hidden="true">🎻</span>
        <div><strong>Friday Session</strong><small>3 jigs in a set</small></div>
        <Button size="sm" variant={copied ? "default" : "outline"} onClick={() => setCopied(true)} aria-label={copied ? "Copied" : "Copy link"}>
          {copied ? <><Check size={14} /><span className="lp-btn-text">Copied</span></> : <><Link2 size={14} /><span className="lp-btn-text">Copy link</span></>}
        </Button>
      </div>
      <div className="lp-book-set-row">
        <RepeatMark />
        <div className="lp-chips">
          {BOOK.map((tune, i) => (
            <Chip key={tune.title} pressed={i === chosen} onClick={() => setChosen(i)}>{tune.title}</Chip>
          ))}
        </div>
      </div>
      <div className="lp-book-phrase">
        <motion.div key={chosen} ref={paper} className="opening-phrase" role="img" aria-label={`Opening bars of ${BOOK[chosen].title}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} />
        <div className="lp-playalong">
          <Button size="icon" className="player-play" data-loading={loading ? "" : undefined} onClick={play} aria-label={playing ? "Stop" : `Play along with ${BOOK[chosen].title}`}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </Button>
          <div className="lp-playalong-main">
            <span className="lp-playalong-title">{options.length ? "Play along with guitar" : "Hear it"}</span>
            {options.length > 0 && (
              <SegmentedControl label="Play-along instrument" value={String(instrument)} onChange={(i) => choose(Number(i))}
                options={options.map((option, i) => ({ value: String(i), label: lead(option.label) }))} />
            )}
            <span className="lp-playalong-bar" aria-hidden="true"><span ref={bar} /></span>
          </div>
        </div>
      </div>
    </Card>
  );
}
